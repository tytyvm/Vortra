import crypto from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");
