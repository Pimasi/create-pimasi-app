import { $mongo } from "../services/db";
import { UsersRepo, UserModel } from "./users";

const _users = $mongo.collection<UserModel>("users");

export const usersRepo: UsersRepo = {
    async findById(id) {
        return _users.findOne({ id }, { projection: { _id: 0 } });
    },

    async findByEmail(email) {
        return _users.findOne({ email }, { projection: { _id: 0 } });
    },

    async findByFirebaseOrEmail(firebaseId, email) {
        return _users.findOne(
            { $or: [{ firebase_id: firebaseId }, { email }] },
            { projection: { _id: 0 } },
        );
    },

    async insert(user) {
        await _users.insertOne(user);
    },

    async update(id, changes) {
        await _users.updateOne({ id }, { $set: changes });
    },
};
