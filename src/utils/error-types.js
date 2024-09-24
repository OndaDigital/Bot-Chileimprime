class ApplicationError extends Error {
    constructor(message, status) {
      super(message);
      this.name = this.constructor.name;
      this.status = status || 500;
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  class ValidationError extends ApplicationError {
    constructor(message) {
      super(message || 'Validation Error', 400);
    }
  }
  
  class NotFoundError extends ApplicationError {
    constructor(message) {
      super(message || 'Resource Not Found', 404);
    }
  }
  
  class UnauthorizedError extends ApplicationError {
    constructor(message) {
      super(message || 'Unauthorized', 401);
    }
  }
  
  export { ApplicationError, ValidationError, NotFoundError, UnauthorizedError };