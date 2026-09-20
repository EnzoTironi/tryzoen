/** Credentials require explicit access and stay redacted in logs and JSON. */
export class Secret<Value = string> {
  readonly #value: Value;
  constructor(value: Value) {
    this.#value = value;
  }
  reveal(): Value {
    return this.#value;
  }
  toJSON() {
    return "<redacted>";
  }
  toString() {
    return "<redacted>";
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return "<redacted>";
  }
}
