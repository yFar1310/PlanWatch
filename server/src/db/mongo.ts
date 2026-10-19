import dotenv from 'dotenv';
import { MongoClient, Db } from 'mongodb';

dotenv.config();

const url : any = process.env.MONGO_URL;
if (!url) {
  throw new Error('MONGO_URL is not set');
}

let client: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getMongoDb(): Promise<Db> {
  if (cachedDb) return cachedDb;
  client ??= new MongoClient(url, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
  await client.connect();
  cachedDb = client.db();
  return cachedDb;
}

export async function closeMongo() {
  if (client) await client.close();
}
