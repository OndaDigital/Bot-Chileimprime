import { ValidationError } from './error-types.js';

export const validators = {
  validateMeasurements(width, height, serviceDetails) {
    if (width <= 0 || height <= 0) {
      throw new ValidationError('Las medidas deben ser números positivos.');
    }
    if (serviceDetails.maxWidth && width > serviceDetails.maxWidth) {
      throw new ValidationError(`El ancho máximo permitido es ${serviceDetails.maxWidth}cm.`);
    }
    if (serviceDetails.maxHeight && height > serviceDetails.maxHeight) {
      throw new ValidationError(`El alto máximo permitido es ${serviceDetails.maxHeight}cm.`);
    }
  },

  validateFinishings(finishings, serviceDetails) {
    for (const [finishing, isSelected] of Object.entries(finishings)) {
      if (isSelected && !serviceDetails.finishings[finishing]) {
        throw new ValidationError(`El acabado "${finishing}" no está disponible para este servicio.`);
      }
    }
  },

  validateQuantity(quantity, serviceDetails) {
    if (quantity <= 0 || !Number.isInteger(quantity)) {
      throw new ValidationError('La cantidad debe ser un número entero positivo.');
    }
    if (serviceDetails.maxQuantity && quantity > serviceDetails.maxQuantity) {
      throw new ValidationError(`La cantidad máxima permitida es ${serviceDetails.maxQuantity}.`);
    }
  },

  validateFile(file, serviceDetails) {
    if (!file) {
      throw new ValidationError('Debe proporcionar un archivo.');
    }
    if (!serviceDetails.allowedFileTypes.includes(file.mimetype)) {
      throw new ValidationError(`Tipo de archivo no permitido. Tipos permitidos: ${serviceDetails.allowedFileTypes.join(', ')}`);
    }
    if (file.size > serviceDetails.maxFileSize) {
      throw new ValidationError(`El archivo excede el tamaño máximo permitido de ${serviceDetails.maxFileSize / (1024 * 1024)}MB.`);
    }
  }
};