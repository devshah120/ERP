import mongoose from "mongoose";
await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/garment-erp?replicaSet=rs0");
const db = mongoose.connection.db;
for (const c of ["salesinvoices","purchaseinvoices","creditnotes","debitnotes","payments","vouchers"]) {
  try {
    const n = await db.collection(c).countDocuments({});
    console.log(c, n);
  } catch (e) { console.log(c, "ERR", e.message); }
}
await mongoose.disconnect();
