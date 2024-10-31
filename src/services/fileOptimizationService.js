// services/fileOptimizationService.js
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';

class FileOptimizationService {
    constructor() {
        // Constantes del sistema
        this.MACHINE_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB en bytes
        this.MIN_ACCEPTABLE_FILE_SIZE = 100 * 1024; // 100KB mínimo
        this.MAX_ACCEPTABLE_DPI = 300; // DPI máximo absoluto
        this.BYTES_PER_PIXEL_ESTIMATE = 4; // Estimación de bytes por pixel (CMYK)
        
        // Configuración de DPI por área
        this.DPI_RULES = [
            { maxArea: 1, minDPI: 150, maxDPI: 300, viewDistance: 1, tolerance: 0.2 },
            { maxArea: 3, minDPI: 100, maxDPI: 150, viewDistance: 2, tolerance: 0.25 },
            { maxArea: 5, minDPI: 75, maxDPI: 100, viewDistance: 3, tolerance: 0.3 },
            { maxArea: 10, minDPI: 50, maxDPI: 75, viewDistance: 5, tolerance: 0.35 },
            { maxArea: 15, minDPI: 35, maxDPI: 50, viewDistance: 7, tolerance: 0.4 },
            { maxArea: 20, minDPI: 25, maxDPI: 35, viewDistance: 10, tolerance: 0.45 },
            { maxArea: 30, minDPI: 15, maxDPI: 25, viewDistance: 15, tolerance: 0.5 },
            { maxArea: 50, minDPI: 10, maxDPI: 20, viewDistance: 20, tolerance: 0.55 },
            { maxArea: Infinity, minDPI: 8, maxDPI: 12, viewDistance: 25, tolerance: 0.6 }
        ];

        this.validateConfiguration();
    }

    validateConfiguration() {
        try {
            for (let i = 0; i < this.DPI_RULES.length - 1; i++) {
                if (this.DPI_RULES[i].maxArea >= this.DPI_RULES[i + 1].maxArea) {
                    throw new Error('Las reglas de DPI deben estar ordenadas por maxArea');
                }
            }

            for (const rule of this.DPI_RULES) {
                if (rule.minDPI > rule.maxDPI) {
                    throw new Error('minDPI no puede ser mayor que maxDPI');
                }
                if (rule.tolerance < 0 || rule.tolerance > 1) {
                    throw new Error('La tolerancia debe estar entre 0 y 1');
                }
            }
            
            logger.info('Configuración de FileOptimizationService validada correctamente');
        } catch (error) {
            logger.error(`Error en la configuración de FileOptimizationService: ${error.message}`);
            throw new CustomError('ConfigurationError', 'Error en la configuración del servicio de optimización', error);
        }
    }

    validateInputParameters(area, currentFileSize, currentDPI) {
        if (!area || area <= 0) {
            throw new CustomError('ValidationError', 'El área debe ser un número positivo');
        }
        if (!currentFileSize || currentFileSize < this.MIN_ACCEPTABLE_FILE_SIZE) {
            throw new CustomError('ValidationError', 'Tamaño de archivo inválido');
        }
        if (!currentDPI || currentDPI <= 0 || currentDPI > this.MAX_ACCEPTABLE_DPI) {
            throw new CustomError('ValidationError', 'DPI fuera de rango aceptable');
        }
    }

    calculateOptimalDPI(area, currentFileSize, currentDPI) {
        try {
            this.validateInputParameters(area, currentFileSize, currentDPI);
            
            logger.info(`Calculando DPI óptimo para área: ${area}m², tamaño actual: ${currentFileSize} bytes, DPI actual: ${currentDPI}`);

            const rule = this.DPI_RULES.find(r => area <= r.maxArea);
            if (!rule) {
                throw new CustomError('ValidationError', `No se encontró regla para área: ${area}m²`);
            }

            // Calcular ratio de reducción necesario basado en tamaño de archivo
            const sizeRatio = currentFileSize / this.MACHINE_MAX_FILE_SIZE;
            let targetDPI = currentDPI;

            if (sizeRatio > 1) {
                targetDPI = Math.floor(currentDPI / Math.sqrt(sizeRatio));
                logger.info(`Reducción de DPI necesaria. Ratio: ${sizeRatio}, Nuevo DPI objetivo: ${targetDPI}`);
            }

            // Ajustar dentro de los límites de la regla
            targetDPI = Math.max(rule.minDPI, Math.min(targetDPI, rule.maxDPI));

            // Calcular estimación de nuevo tamaño
            const estimatedNewSize = this.calculateEstimatedFileSize(area, targetDPI);

            const result = {
                originalDPI: currentDPI,
                recommendedDPI: targetDPI,
                minAcceptableDPI: rule.minDPI,
                maxAcceptableDPI: rule.maxDPI,
                tolerance: rule.tolerance,
                viewDistance: rule.viewDistance,
                willReduceFileSize: targetDPI < currentDPI,
                estimatedNewSize: estimatedNewSize,
                originalSize: currentFileSize,
                isWithinLimits: targetDPI >= rule.minDPI && targetDPI <= rule.maxDPI,
                requiresOptimization: sizeRatio > 1,
                area: area,
                sizeReductionRatio: targetDPI < currentDPI ? (estimatedNewSize / currentFileSize) : 1,
                qualityImpact: this.calculateQualityImpact(currentDPI, targetDPI)
            };

            logger.info(`Análisis de optimización completado: ${JSON.stringify(result)}`);
            return result;

        } catch (error) {
            logger.error(`Error en cálculo de DPI óptimo: ${error.message}`);
            throw error;
        }
    }

    calculateEstimatedFileSize(area, dpi) {
        const areaInInches = area * 1550.0031;
        const totalPixels = areaInInches * dpi * dpi;
        return Math.floor(totalPixels * this.BYTES_PER_PIXEL_ESTIMATE);
    }

    calculateQualityImpact(originalDPI, newDPI) {
        const ratio = newDPI / originalDPI;
        if (ratio >= 1) return 'ninguno';
        if (ratio >= 0.8) return 'mínimo';
        if (ratio >= 0.6) return 'moderado';
        if (ratio >= 0.4) return 'significativo';
        return 'alto';
    }

    generateOptimizationReport(optimizationResult) {
        const sizeInGB = (size) => (size / (1024 * 1024 * 1024)).toFixed(2);
        
        return `
### 📊 *Análisis de Optimización*

1. 🎯 *DPI y Resolución*:
   - DPI Actual: *${optimizationResult.originalDPI}*
   - DPI Recomendado: *${optimizationResult.recommendedDPI}*
   - Rango Aceptable: *${optimizationResult.minAcceptableDPI} - ${optimizationResult.maxAcceptableDPI}*
   - Impacto en Calidad: *${optimizationResult.qualityImpact}*

2. 📏 *Distancia de Visualización*:
   - Distancia Óptima: *${optimizationResult.viewDistance} metros*
   - Tolerancia Permitida: *${(optimizationResult.tolerance * 100).toFixed(0)}%*

3. 💾 *Análisis de Archivo*:
   - Tamaño Actual: *${sizeInGB(optimizationResult.originalSize)} GB*
   - Tamaño Estimado Después de Optimización: *${sizeInGB(optimizationResult.estimatedNewSize)} GB*
   ${optimizationResult.requiresOptimization ? 
     `⚠️ *Se requiere optimización para procesamiento*\n   Razón: El archivo excede el límite de ${sizeInGB(this.MACHINE_MAX_FILE_SIZE)} GB` : 
     '✅ *Tamaño dentro de límites aceptables*'}

4. 🔧 *Recomendaciones*:
   ${this.generateRecommendations(optimizationResult)}

5. ℹ️ *Información Adicional*:
   - Área de Impresión: *${optimizationResult.area.toFixed(2)} m²*
   - Categoría de Impresión: *${this.getAreaCategory(optimizationResult.area)}*
   ${this.generateAdditionalNotes(optimizationResult)}
`;
    }

    getAreaCategory(area) {
        if (area <= 1) return "Pequeño formato";
        if (area <= 5) return "Formato mediano";
        if (area <= 20) return "Gran formato";
        return "Formato extra grande";
    }

    generateRecommendations(result) {
        const recommendations = [];

        if (result.requiresOptimization) {
            recommendations.push(`- Reducir el DPI a *${result.recommendedDPI}* para optimizar el procesamiento`);
            recommendations.push(`- Utilizar compresión de imagen preservando la calidad visual`);
            
            if (result.qualityImpact !== 'mínimo') {
                recommendations.push(`- Considerar dividir el diseño en secciones si requiere mayor calidad`);
            }
        }

        if (result.originalDPI > result.maxAcceptableDPI) {
            recommendations.push(`- El DPI actual es excesivo para el área de impresión`);
            recommendations.push(`- Reducir a máximo *${result.maxAcceptableDPI} DPI* para mejor rendimiento`);
        }

        if (result.area > 20) {
            recommendations.push(`- Considerar técnicas de optimización específicas para impresiones de gran formato`);
            recommendations.push(`- Verificar la compatibilidad del diseño con visualización a distancia`);
        }

        // Recomendaciones específicas según el tamaño del archivo
        if (result.originalSize > this.MACHINE_MAX_FILE_SIZE * 0.8) {
            recommendations.push(`- ⚠️ El archivo está cerca o supera el límite máximo de *2GB*`);
            recommendations.push(`- Considerar reducir el DPI o dividir el diseño en secciones`);
        }

        // Recomendaciones de color
        if (result.colorSpace && result.colorSpace !== 'CMYK') {
            recommendations.push(`- Convertir el archivo a modo de color *CMYK* para mejor fidelidad de impresión`);
        }

        if (recommendations.length === 0) {
            recommendations.push(`✅ Archivo óptimo para impresión`);
        }

        return recommendations.join('\n   ');
    }

    generateAdditionalNotes(result) {
        const notes = [];

        // Notas sobre visualización
        if (result.area > 10) {
            notes.push(`- Para este tamaño de impresión, la visualización óptima es desde *${result.viewDistance} metros*`);
        }

        // Notas sobre optimización
        if (result.requiresOptimization) {
            notes.push(`- La optimización sugerida mantendrá la calidad visual apropiada para la distancia de visualización`);
            
            if (result.sizeReductionRatio < 0.5) {
                notes.push(`- La reducción significativa del tamaño del archivo mejorará el tiempo de procesamiento`);
            }
        }

        // Notas sobre calidad
        if (result.qualityImpact !== 'ninguno') {
            notes.push(`- El impacto en la calidad será *${result.qualityImpact}*, pero no será perceptible a la distancia de visualización recomendada`);
            
            if (result.qualityImpact === 'significativo' || result.qualityImpact === 'alto') {
                notes.push(`- Se recomienda realizar una prueba de impresión en un área pequeña antes de proceder con la impresión completa`);
            }
        }

        // Notas sobre el formato de archivo
        if (result.area > 30) {
            notes.push(`- Para impresiones de gran formato, asegúrate de que las marcas de corte y sangrado estén correctamente definidas`);
        }

        return notes.length > 0 ? notes.join('\n   ') : '';
    }

    // Método auxiliar para conversión de bytes a unidad legible
    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    // Método para validar si un archivo puede ser procesado
    canProcessFile(fileSize) {
        if (fileSize > this.MACHINE_MAX_FILE_SIZE) {
            logger.warn(`Archivo demasiado grande: ${this.formatFileSize(fileSize)}`);
            return false;
        }
        return true;
    }

    // Método para sugerir división de archivo
    suggestFileSplitting(area, currentDPI) {
        const currentPixels = area * 1550.0031 * currentDPI * currentDPI;
        const maxPixels = this.MACHINE_MAX_FILE_SIZE / this.BYTES_PER_PIXEL_ESTIMATE;
        
        if (currentPixels > maxPixels) {
            const recommendedSections = Math.ceil(currentPixels / maxPixels);
            const sectionArea = area / recommendedSections;
            
            return {
                needsSplitting: true,
                recommendedSections,
                sectionArea: sectionArea.toFixed(2),
                recommendation: `Se recomienda dividir el diseño en ${recommendedSections} secciones de aproximadamente ${sectionArea.toFixed(2)} m² cada una`
            };
        }
        
        return { needsSplitting: false };
    }
}

export default new FileOptimizationService();