import { MongoClient } from "mongodb";
import { $env } from "../utils/env";

export const $mongo = new MongoClient($env.MONGO_URL).db($env.MONGO_DATABASE);
