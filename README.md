# Adams Foods Inventory

A comprehensive full-stack freezer inventory management system for Adams Foods, built with React, Express, and PostgreSQL.

## Project Overview

Adams Foods Inventory is a web-based application designed to manage and track frozen food inventory. The system allows users to:

- Track freezer inventory with detailed product information
- Monitor lot numbers and expiration dates
- Scan products using barcode/QR code scanning
- Generate production orders and reports
- Process incoming records with receipt validation
- Archive and restore inventory items
- View inventory analytics and dashboards

## Tech Stack

### Frontend
- **React 18** - UI framework
- **React Router 7** - Client-side routing
- **Chakra UI** - Component library
- **Axios** - HTTP client
- **Recharts** - Data visualization
- **Framer Motion** - Animations
- **Excel Support** - Import/export with read-excel-file and xlsx

### Backend
- **Express.js** - Web server framework
- **PostgreSQL** - Primary database
- **Mongoose** - MongoDB support
- **Multer** - File upload handling
- **JWT** - Authentication
- **Bcrypt** - Password hashing
- **AWS SDK** - S3 and Textract integration
- **OpenAI API** - Text processing capabilities
- **Sharp** - Image processing
- **HEIC Conversion** - Apple image format support

### Development
- **Node.js** - Runtime environment
- **npm** - Package manager
- **Nodemon** - Development server auto-reload
- **Jest** - Testing framework
- **Supertest** - HTTP assertion library

## Project Structure

```
AdamsFoodsInventory/
├── client/                 # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable React components
│   │   ├── pages/         # Page components
│   │   └── ...
│   ├── package.json
│   └── README.md
├── server/                # Express backend application
│   ├── routes/            # API route handlers
│   ├── index.js          # Server entry point
│   └── package.json
├── package.json          # Root package configuration
└── task.md              # Documentation of vulnerabilities and fixes
```

## Getting Started

### Prerequisites
- Node.js 16+ and npm
- PostgreSQL database
- AWS account (for S3/Textract features)
- OpenAI API key

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   cd client && npm install
   cd ../server && npm install
   cd ..
   ```

3. Create a `.env` file in the server directory with required environment variables:
   ```
   DATABASE_URL=postgresql://...
   JWT_SECRET=...
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   OPENAI_API_KEY=...
   ```

### Running the Application

**Development Mode:**
```bash
# Terminal 1: Start backend server
cd server && npm start

# Terminal 2: Start React development server
cd client && npm start
```

The application will be available at http://localhost:3000

**Production Build:**
```bash
cd client && npm run build
cd ../server && npm start
```

### Testing
```bash
cd server && npm test
```

## Key Features

### Inventory Management
- Real-time freezer inventory tracking
- Product details including lot numbers and expiration dates
- Sort and filter capabilities
- Quick search functionality

### Barcode Scanning
- Built-in barcode/QR code scanner
- Batch scanning support
- Automatic data validation

### Production Orders
- Generate production orders from inventory
- Track order status and fulfillment
- Export reports

### Analytics
- Inventory dashboards with visualizations
- Trend analysis
- Usage reports

### File Handling
- Excel import/export for bulk operations
- HEIC image conversion for photos
- Document scanning with AWS Textract

## Security Considerations

### Authentication
- JWT-based authentication
- Secure password hashing with bcrypt
- Protected API routes

### Dependency Security
This project maintains a security audit of dependencies. Some known vulnerabilities exist in transitive dependencies that are primarily in development/testing packages and have limited security impact in this context:

**Client-side:**
- react-router: Known vulnerabilities (various XSS/redirect issues)
- xlsx: Prototype pollution and ReDoS vulnerabilities with no available fix

**Server-side:**
- Jest and related testing dependencies have transitive vulnerabilities in packages like brace-expansion, form-data, and others
- These are development-only dependencies and do not affect production security

To review all dependencies and vulnerabilities:
```bash
npm audit
```

## Deployment

The project includes deployment scripts for automated cloud deployment:

```bash
npm run deploy          # Deploy both client and server
npm run deploy:server   # Deploy server only
npm run deploy:client   # Deploy client only
```

See `package.json` for deployment configuration details.

## Development Guidelines

- Follow the existing code structure and naming conventions
- Test changes thoroughly before committing
- Run `npm audit` before pushing to identify new vulnerabilities
- Update package versions to address security issues when available

## Database Schema

The system uses PostgreSQL for primary data storage with support for:
- Freezer inventory records
- Product lot tracking
- User authentication
- Transaction/order history
- Audit logs

## API Documentation

The backend API is RESTful and provides endpoints for:
- Authentication (`/auth`)
- Inventory management (`/inventory`)
- Scanning (`/scan`)
- Orders (`/orders`)
- File uploads (`/upload`)
- Reports (`/reports`)

## Contributing

When contributing to this project:
1. Create a feature branch from master
2. Make your changes
3. Test thoroughly
4. Create a pull request with clear descriptions

## License

This project is private and proprietary to Adams Foods.

## Support

For questions or issues, contact the development team or refer to the project documentation.

---

**Last Updated:** 2026-07-27
**Project Status:** Active Development
