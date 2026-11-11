import { Schema } from "mongoose";

export interface IAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string;
}

export const addressSchema = new Schema<IAddress>(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
  },
  { _id: false }
);
