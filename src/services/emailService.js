// Archivo: services/emailService.js

import nodemailer from 'nodemailer';
import config from '../config/config.js';
import logger from '../utils/logger.js';

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.gmailUserEmail,
        pass: config.gmailAppPassword, // Contraseña de aplicación
      },
    });

    logger.info('Servicio de correo electrónico inicializado correctamente con Nodemailer');
  }

  async sendEmail(order, orderNumber) {
    try {
      const emailSubject = `Cotización WA-${orderNumber} recibida`;
      const emailBody = this.constructEmailBody(order, orderNumber);

      const mailOptions = {
        from: config.gmailUserEmail,
        to: config.gmailUserEmail, // Enviar a tu propia cuenta
        subject: emailSubject,
        text: emailBody,
      };

      logger.info(`Enviando correo electrónico para la cotización ${orderNumber}`);

      await this.transporter.sendMail(mailOptions);

      logger.info(`Correo electrónico enviado correctamente para la cotización ${orderNumber}`);
    } catch (error) {
      logger.error(`Error al enviar correo electrónico para la cotización ${orderNumber}: ${error.message}`);
      // Manejo adicional de errores si es necesario
    }
  }

  constructEmailBody(order, orderNumber) {
    let body = `Estimado equipo,\n\n`;
    body += `Se ha recibido una nueva cotización con el número WA-${orderNumber}.\n\n`;
    body += `Detalles de la cotización:\n`;
    body += `- Fecha: ${order.fecha}\n`;
    body += `- Cliente: ${order.nombre}\n`;
    body += `- Teléfono: ${order.telefono}\n`;
    body += `- Servicio: ${order.servicio}\n`;
    if (order.measures) {
      body += `- Medidas: ${order.measures.width}m x ${order.measures.height}m\n`;
    }
    body += `- Cantidad: ${order.cantidad}\n`;
    if (order.area) {
      body += `- Área: ${order.area} m²\n`;
    }
    if (order.terminaciones && order.terminaciones.length > 0) {
      body += `- Terminaciones: ${order.terminaciones.join(', ')}\n`;
    }
    body += `- Precio Total: $${order.total}\n`;
    if (order.observaciones) {
      body += `- Observaciones: ${order.observaciones}\n`;
    }
    if (order.fileUrl) {
      body += `- Enlace al archivo en Google Drive: ${order.fileUrl}\n`;
    }
    body += `\nPor favor, procedan con el seguimiento correspondiente.\n\nSaludos,\nBot de Chileimprime`;

    return body;
  }
}

export default new EmailService();
