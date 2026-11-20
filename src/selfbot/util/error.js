// SupiError aus supi-core (AGPL-3.0, Supinic), unveraendert bis auf CommonJS
class SupiError extends globalThis.Error {
	#args;
	#timestamp;
	#messageDescriptor;
	#cause;
	constructor(obj) {
		const { args, cause, message, name } = obj;
		super(message, { cause });
		this.#args = args ?? {};
		this.#cause = cause ?? null;
		this.name = name ?? 'sb.Error';
		this.#timestamp = Date.now();
		const messageDescriptor = Object.getOwnPropertyDescriptor(this, 'message');
		if (!messageDescriptor) {
			throw new globalThis.Error('Message descriptor must be defined');
		}
		this.#messageDescriptor = messageDescriptor;
		Object.defineProperty(this, 'message', {
			get: () => {
				const superMessage = typeof this.#messageDescriptor.get === 'function' ? this.#messageDescriptor.get() : this.#messageDescriptor.value;
				const parts = [superMessage];
				if (Object.keys(this.#args).length !== 0) {
					parts.push(`- arguments: ${JSON.stringify(this.#args)}`);
				}
				if (this.#cause) {
					const causeMessage = `cause: ${this.#cause.message} ${this.#cause.stack ?? '(no stack)'}`;
					const tabbedMessage = causeMessage
						.trim()
						.split('\n')
						.map((i) => `\t${i}`)
						.join('\n');
					parts.push(tabbedMessage);
				}
				return `${parts.join('\n')}\n`;
			},
		});
	}
	get simpleMessage() {
		return typeof this.#messageDescriptor.get === 'function' ? this.#messageDescriptor.get() : this.#messageDescriptor.value;
	}
	get args() {
		return this.#args;
	}
	get timestamp() {
		return this.#timestamp;
	}
	get date() {
		return new Date(this.#timestamp);
	}
}
class GenericRequestError extends SupiError {
	statusCode;
	statusMessage;
	hostname;
	constructor(object) {
		super({
			message: object.message,
			name: 'GenericRequestError',
			args: {
				...object.args,
				statusCode: object.statusCode ?? null,
				statusMessage: object.statusMessage ?? null,
				hostname: object.hostname ?? null,
			},
		});
		this.statusCode = object.statusCode ?? null;
		this.statusMessage = object.statusMessage ?? null;
		this.hostname = object.hostname ?? null;
	}
	static get name() {
		return 'GenericRequestError';
	}
}
const isSupiError = (input) => input instanceof SupiError;
const isGenericRequestError = (input) => input instanceof GenericRequestError;

module.exports = { SupiError, GenericRequestError, isSupiError, isGenericRequestError };
