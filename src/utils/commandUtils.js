// utils/commandUtils.js

import logger from './logger.js';

const knownCommands = {
  'LIST_ALL_SERVICES': ['list all services', 'listallservices'],
  'SELECT_SERVICE': ['select service', 'selectservice'],
  'SET_MEASURES': ['set measures', 'setmeasures'],
  'SET_QUANTITY': ['set quantity', 'setquantity'],
  'SET_FINISHES': ['set finishes', 'setfinishes'],
  'CONFIRM_ORDER': ['confirm order', 'confirmorder'],
  'RESULT_ANALYSIS': ['result analysis', 'resultanalysis'],
  'LIST_LAST_ORDERS': ['list last orders', 'listlastorders', 'last orders', 'lastorders'],
};

export function normalizeCommand(command) {
  return command.toLowerCase().replace(/\s+/g, '_');
}

export function findClosestCommand(command) {
  const normalizedCommand = normalizeCommand(command);
  
  // Primero, buscar una coincidencia exacta
  for (const [knownCommand, variations] of Object.entries(knownCommands)) {
    if (normalizedCommand === knownCommand.toLowerCase() || variations.includes(normalizedCommand)) {
      return knownCommand;
    }
  }
  
  // Si no hay coincidencia exacta, usar la distancia de Levenshtein
  let closestCommand = null;
  let minDistance = Infinity;
  
  for (const knownCommand of Object.keys(knownCommands)) {
    const distance = levenshteinDistance(normalizedCommand, knownCommand.toLowerCase());
    if (distance < minDistance) {
      minDistance = distance;
      closestCommand = knownCommand;
    }
  }
  
  // Solo devolver el comando más cercano si la distancia es menor que un umbral
  return minDistance <= 3 ? closestCommand : null;
}

function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export function sanitizeJsonString(jsonString) {
  // Asegurar que las propiedades del JSON estén entre comillas dobles
  return jsonString.replace(/(\w+):/g, '"$1":');
}