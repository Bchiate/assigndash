'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { AuthError } = require('./errors');

const scrypt = promisify(crypto.scrypt);

/**
 * In-memory accounts for demo mode and tests. Passwords are hashed with scrypt even here,
 * because a public demo deployment still receives real passwords from people trying it.
 * When `maxUsers` is reached the oldest account is evicted and `onEvict` is called so the
 * store can drop that user's data too.
 */
function createMemoryAuth({ requireConfirmation = false, maxUsers = 1000, onEvict = () => {} } = {}) {
  const usersById = new Map();
  const userIdsByEmail = new Map();

  function makeRoom() {
    while (usersById.size >= maxUsers) {
      const [oldestId, oldest] = usersById.entries().next().value;
      usersById.delete(oldestId);
      userIdsByEmail.delete(oldest.email);
      onEvict(oldestId);
    }
  }

  async function createUser({ email, password, name, confirmed }) {
    makeRoom();
    const salt = crypto.randomBytes(16);
    const user = {
      id: crypto.randomUUID(),
      email,
      name,
      salt,
      hash: await scrypt(password, salt, 32),
      confirmed,
    };
    usersById.set(user.id, user);
    userIdsByEmail.set(email, user.id);
    return user;
  }

  return {
    async signUp({ email, password, name }) {
      if (userIdsByEmail.has(email)) {
        // Same behaviour as Supabase with confirmations on: don't reveal that the address exists.
        if (requireConfirmation) return { userId: null, name, needsConfirmation: true };
        throw new AuthError('user_exists');
      }
      const user = await createUser({ email, password, name, confirmed: !requireConfirmation });
      return { userId: requireConfirmation ? null : user.id, name, needsConfirmation: requireConfirmation };
    },

    async signIn({ email, password }) {
      const user = usersById.get(userIdsByEmail.get(email));
      // Hash even for unknown emails so response time doesn't reveal which accounts exist.
      const candidate = await scrypt(password, user ? user.salt : crypto.randomBytes(16), 32);
      if (!user || !crypto.timingSafeEqual(candidate, user.hash)) throw new AuthError('invalid_credentials');
      if (!user.confirmed) throw new AuthError('email_not_confirmed');
      return { userId: user.id, name: user.name };
    },

    async getUser(userId) {
      const user = usersById.get(userId);
      return user ? { id: user.id, email: user.email, name: user.name } : null;
    },

    async resendConfirmation() {},

    /** Demo mode: a fresh throwaway account per visitor, so visitors never share data. */
    async createDemoUser() {
      const user = await createUser({
        email: `demo-${crypto.randomBytes(6).toString('hex')}@demo.invalid`,
        password: crypto.randomBytes(24).toString('base64url'),
        name: 'Demo Student',
        confirmed: true,
      });
      return { userId: user.id, name: user.name };
    },

    /** Test helper standing in for clicking the link in a confirmation email. */
    confirmEmail(email) {
      const user = usersById.get(userIdsByEmail.get(email));
      if (user) user.confirmed = true;
    },
  };
}

module.exports = { createMemoryAuth };
