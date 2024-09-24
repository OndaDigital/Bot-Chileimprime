import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

class SheetsService {
  constructor() {
    this.jwtFromEnv = new JWT({
      email: config.googleSheets.credentials.client_email,
      key: config.googleSheets.credentials.private_key.replace(/\\n/g, "\n"),
      scopes: SCOPES,
    });
    this.doc = new GoogleSpreadsheet(config.googleSheets.sheetId, this.jwtFromEnv);
  }

  async initialize() {
    try {
      await this.doc.loadInfo();
      logger.info('Google Sheets service initialized');
    } catch (error) {
      logger.error('Error initializing Google Sheets', error);
      throw error;
    }
  }

  async getMenu() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[0];
      await sheet.loadCells();

      let menu = {};
      const startRow = 7;

      let categories = [];
      for (let col = 0; col < sheet.columnCount; col++) {
        const cellValue = sheet.getCell(startRow, col).value;
        if (cellValue && typeof cellValue === 'string' && cellValue.trim() !== '') {
          categories.push(cellValue.trim());
        } else {
          break;
        }
      }

      categories.forEach((category, index) => {
        let categoryItems = [];
        for (let row = startRow + 1; row < sheet.rowCount; row++) {
          const item = sheet.getCell(row, index).value;
          const price = sheet.getCell(row, index).note;
          if (item) {
            let extractedPrice = price;
            if (!extractedPrice) {
              const priceMatch = item.match(/\$(\d+)/);
              if (priceMatch) {
                extractedPrice = priceMatch[1];
              }
            }
            if (extractedPrice) {
              categoryItems.push(`${category} - ${item.replace(/\$\d+/, '').trim()} $${extractedPrice}`);
            }
          } else {
            break;
          }
        }
        menu[category] = categoryItems;
      });

      return menu;
    } catch (error) {
      logger.error('Error fetching menu from Google Sheets', error);
      throw error;
    }
  }

  async saveOrder(order) {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1];
      await sheet.addRow(order);
      logger.info(`Order saved for user ${order.userId}`);
    } catch (error) {
      logger.error('Error saving order to Google Sheets', error);
      throw error;
    }
  }
}

export const sheetsService = new SheetsService();