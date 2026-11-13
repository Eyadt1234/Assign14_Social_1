import { User } from "./models/user.model.js";
import { encrypt, isEncrypted } from "../utils/encryption.js";

//safe to run many times
export const migrate = async (): Promise<{ phones: number; roles: number }> => {
  //1: phones saved before the encryption
  let phones = 0;
  for await (const user of User.find({ phone: { $exists: true, $ne: "" } })) {
    if (user.phone && !isEncrypted(user.phone)) {
      await User.updateOne({ _id: user._id }, { $set: { phone: encrypt(user.phone) } });
      phones++;
    }
  }

  //2: users that were created before the roles
  const roles = await User.updateMany({ role: { $exists: false } }, { $set: { role: "user" } });
  return { phones, roles: roles.modifiedCount };
};