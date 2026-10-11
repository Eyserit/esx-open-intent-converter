export class NotSupportedError extends Error {}

export class ConversionError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
