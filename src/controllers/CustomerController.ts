import { plainToClass } from "class-transformer";
import { validate } from "class-validator";
import { NextFunction, Request, Response } from "express";
import {
  CreateCustomerInput,
  CustomerEditInput,
  CustomerLoginInput,
} from "../dto";
import { Customer } from "../models";
import {
  GenerateOtp,
  GeneratePassword,
  GenerateSalt,
  GenerateSignature,
  SendOtp,
  ValidatePassword,
} from "../utility";
import { webhook } from "twilio/lib/webhooks/webhooks";

export const CustomerSignUp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const customerInputs = plainToClass(CreateCustomerInput, req.body);

    const inputErrors = await validate(customerInputs, {
      validationError: { target: true },
    });
    if (inputErrors.length > 0) {
      return res.status(400).json(inputErrors);
    }

    const { email, phone, password } = req.body;

    const existingCustomer = await Customer.findOne({
      email: email.toLowerCase(),
    });
    if (existingCustomer) {
      return res
        .status(400)
        .json({ message: "This email address is already in use!" });
    }

    const salt = await GenerateSalt();
    const userPassword = await GeneratePassword(password, salt);

    const { otp, expiry } = GenerateOtp();

    const createdCustomer = await Customer.create({
      email: email.toLowerCase(),
      password: userPassword,
      phone: phone,
      salt: salt,
      otp: otp,
      otpExpiry: expiry,
      firstName: "",
      lastName: "",
      address: "",
      verified: false,
      lat: 0,
      lng: 0,
    });

    if (createdCustomer) {
      await SendOtp(otp, phone);

      const signature = GenerateSignature({
        _id: createdCustomer._id,
        email: createdCustomer.email,
        verified: createdCustomer.verified,
      });

      return res.status(201).json({
        signature,
        verified: createdCustomer.verified,
        email: createdCustomer.email,
      });
    }

    return res.status(400).json({ message: "Error while signing up!" });
  } catch (e: any) {
    console.log(e.message);
    next(e);
  }
};

export const CustomerLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const loginInputs = plainToClass(CustomerLoginInput, req.body);
  const loginErrors = await validate(loginInputs, {
    validationError: { target: false },
  });

  if (loginErrors.length > 0) {
    return res.status(400).json(loginErrors);
  }

  const { email, password } = req.body;

  const customer = await Customer.findOne({ email: email });

  if (customer) {
    const validPassword = await ValidatePassword(password, customer.password);
    if (validPassword) {
      const signature = GenerateSignature({
        _id: customer._id,
        email: customer.email,
        verified: customer.verified,
      });

      return res.status(200).json({
        signature,
        email: customer.email,
        verified: customer.verified,
      });
    }
  }

  return res.status(400).send({ message: "Invalid credentials!" });
};

export const CustomerVerify = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { otp } = req.body;
    const customer = req.user;

    if (customer) {
      const profile = await Customer.findById(customer._id);

      if (
        profile &&
        profile.otp === parseInt(otp) &&
        profile.otpExpiry >= new Date()
      ) {
        profile.verified = true;
        const updatedProfile = await profile.save();

        const signature = GenerateSignature({
          _id: updatedProfile._id,
          email: updatedProfile.email,
          verified: updatedProfile.verified,
        });

        return res.status(200).json({
          signature,
          verified: updatedProfile.verified,
          email: updatedProfile.email,
        });
      }
    }
    return res.status(400).json({ message: "OPT verification failed!" });
  } catch (e: any) {
    console.log(e.message);
    next(e);
  }
};

export const RequestOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const customer = req.user;

  if (customer) {
    const profile = await Customer.findById(customer._id);

    if (profile) {
      const { otp, expiry } = GenerateOtp();

      profile.otp = otp;
      profile.otpExpiry = expiry;

      await profile.save();
      await SendOtp(otp, profile.phone);

      return res
        .status(200)
        .json({ message: "OTP sent to your registered phone number." });
    }
  }

  return res.status(400).json({ message: "Error generateing OTP!" });
};

export const GetCustomerProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const customer = req.user;

  if (customer) {
    const profile = await Customer.findById(customer._id);
    if (profile) {
      return res.status(200).json(profile);
    }
  }

  return res.status(400).json({ message: "Error getting user profile!" });
};

export const UpdateCustomerProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const customer = req.user;

  if (customer) {
    const profile = await Customer.findById(customer._id);

    if (profile) {
      const customerInputs = plainToClass(CustomerEditInput, req.body);
      const inputErrors = await validate(customerInputs, {
        validationError: { target: false },
      });

      if (inputErrors.length > 0) {
        return res.status(400).json(inputErrors);
      }

      const { firstName, lastName, address } = req.body;

      profile.firstName = firstName;
      profile.lastName = lastName;
      profile.address = address;

      const updatedProfile = await profile.save();

      return res.status(200).json(updatedProfile);
    }
  }

  return res.status(400).json({ message: "Error updating profile!" });
};