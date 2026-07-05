# thermal-printer-app
Desktop thermal label printing application for 80mm printers.

---

## 🚀 Getting Started

### Prerequisites
Before running or building the project, ensure you have installed:
* [Node.js](https://nodejs.org/) (v18.x or higher recommended)
* NPM (comes bundled with Node.js)
* Drivers for your 80mm thermal printer installed on your OS

### 💻 How to Run (Development)

1. Clone the repository and navigate to the project directory:
   ```bash
   git clone https://github.com/christiantojimmy/thermal-printer-app.git
   cd thermal-label-printer
   ```

2. Install all dependencies:
   ```bash
   npm install
   ```

3. Start the application in development mode:
   ```bash
   npm start
   ```

### 📦 How to Build (Production)
To package the application into standalone production-ready executables (.exe for Windows, .dmg for macOS, or .deb/.rpm for Linux):
```bash
npm run dist
```
The production installers and packages will be generated inside the /dist or /out directory.