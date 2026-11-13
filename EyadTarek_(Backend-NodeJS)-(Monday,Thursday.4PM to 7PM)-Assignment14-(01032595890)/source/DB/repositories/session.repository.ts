import type { HydratedDocument, Types } from "mongoose";
import { Session, type ISession } from "../models/session.model.js";

type Id = string | Types.ObjectId;

export type SessionDocument = HydratedDocument<ISession>;

export class SessionRepository {
  //1: create
  public create(userId: Id, refreshJti: string, expiresAt: Date): Promise<SessionDocument> {
    return Session.create({ userId, refreshJti, expiresAt });
  }

  //_________________________________________________________________________________//

  //2: findValid
  public async findValid(sessionId: string, userId: string): Promise<SessionDocument | null> {
    const session = await Session.findOne({ _id: sessionId, userId });
    return session && session.expiresAt.getTime() > Date.now() ? session : null;
  }

  //_________________________________________________________________________________//

  //3: rotate
  public async rotate(sessionId: Id, oldJti: string, newJti: string): Promise<boolean> {
    const session = await Session.findOneAndUpdate({ _id: sessionId, refreshJti: oldJti }, { $set: { refreshJti: newJti } });
    return session !== null;
  }

  //_________________________________________________________________________________//

  //4: deleteById
  public async deleteById(sessionId: Id): Promise<void> {
    await Session.deleteOne({ _id: sessionId });
  }

  //_________________________________________________________________________________//

  //5: deleteAllOfUser
  public async deleteAllOfUser(userId: Id, exceptSessionId?: string): Promise<void> {
    await Session.deleteMany(exceptSessionId ? { userId, _id: { $ne: exceptSessionId } } : { userId });
  }
}

export const sessionRepository = new SessionRepository();