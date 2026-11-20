// Cooldowns pro Channel+User+Command und "pending"-Sperre pro User (ein Command gleichzeitig).
// Wie DontAddThisBot ein Modul mit set/has/delete, intern wie Supibots CooldownManager.

class CooldownManager {
	#cooldowns = new Map();
	#pending = new Map();
	#pendingTimeout;

	constructor(pendingTimeout = 300_000) {
		this.#pendingTimeout = pendingTimeout;
	}

	static key(channel, user, command) {
		return `${channel ?? 'pm'}:${user}:${command}`;
	}

	/** true = darf ausgefuehrt werden */
	check(channel, user, command, skipPending = false, now = Date.now()) {
		if (!skipPending && this.fetchPending(user, now)) {
			return false;
		}
		const until = this.#cooldowns.get(CooldownManager.key(channel, user, command));
		return until === undefined || until <= now;
	}

	set(channel, user, command, length, now = Date.now()) {
		if (length <= 0) {
			return;
		}
		this.#cooldowns.set(CooldownManager.key(channel, user, command), now + length);
	}

	/** Restzeit einer laufenden Sperre (Sekunden aufgerundet) fuer das Flag "cooldown-notice", sonst 0 */
	remaining(channel, user, command, now = Date.now()) {
		const until = this.#cooldowns.get(CooldownManager.key(channel, user, command));
		if (until === undefined || until <= now) {
			return 0;
		}
		return { seconds: Math.max(1, Math.ceil((until - now) / 1000)), until };
	}

	unset(channel, user, command) {
		this.#cooldowns.delete(CooldownManager.key(channel, user, command));
	}

	setPending(user, description, now = Date.now()) {
		this.#pending.set(user, { description, expires: now + this.#pendingTimeout });
	}

	fetchPending(user, now = Date.now()) {
		const pending = this.#pending.get(user);
		if (!pending) {
			return null;
		} else if (pending.expires <= now) {
			this.#pending.delete(user);
			return null;
		}
		return pending;
	}

	unsetPending(user) {
		this.#pending.delete(user);
	}

	/** Abgelaufene Eintraege entfernen, damit die Maps nicht endlos wachsen */
	prune(now = Date.now()) {
		for (const [key, until] of this.#cooldowns) {
			if (until <= now) {
				this.#cooldowns.delete(key);
			}
		}
		for (const [user, pending] of this.#pending) {
			if (pending.expires <= now) {
				this.#pending.delete(user);
			}
		}
	}
}

module.exports = { CooldownManager };
