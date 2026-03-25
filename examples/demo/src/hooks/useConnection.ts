import { use } from "react";
import { connection } from "../connect";
import type { Connection } from "../connect";

export function useConnection(): Connection {
  return use(connection);
}
