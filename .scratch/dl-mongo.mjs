import { MongoBinary } from "mongodb-memory-server-core";
const version = process.argv[2] || "7.0.14";
const p = await MongoBinary.getPath({ version, downloadDir: "D:/ERP/.mongo-bin" });
console.log("BINARY:" + p);
