// Archivo: services/googleDriveService.js

import { google } from 'googleapis';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import fs from 'fs';

class GoogleDriveService {
  constructor() {
    this.driveClient = null;
    this.initializeDriveClient();
  }

  initializeDriveClient() {
    try {
      const auth = new google.auth.JWT(
        config.googleDriveServiceAccountEmail,
        null,
        config.googleDrivePrivateKey,
        ['https://www.googleapis.com/auth/drive']
      );

      this.driveClient = google.drive({
        version: 'v3',
        auth: auth,
      });

      logger.info('Cliente de Google Drive inicializado correctamente con nuevas credenciales');
    } catch (error) {
      logger.error(`Error al inicializar el cliente de Google Drive: ${error.message}`);
    }
  }

  async uploadFile(filePath, fileName, mimeType) {
    try {
      const fileMetadata = {
        name: fileName,
        parents: [config.googleDriveFolderId], // ID de la carpeta en Google Drive donde se guardarán los archivos
      };

      const media = {
        mimeType: mimeType,
        body: fs.createReadStream(filePath),
      };

      logger.info(`Iniciando subida de archivo a Google Drive: ${fileName}`);

      const response = await this.driveClient.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
      });

      logger.info(`Archivo subido a Google Drive. ID: ${response.data.id}`);

      // Hacer el archivo accesible (opcional)
      await this.driveClient.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      return response.data.webViewLink;
    } catch (error) {
      logger.error(`Error al subir archivo a Google Drive: ${error.message}`);
      throw error;
    }
  }
}

export default new GoogleDriveService();
