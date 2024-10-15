// Imports
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

dotenv.config();

// Local imports
import * as websocket from './src/utilities/websocket.js';
import errorHandler from './src/middleware/errorHandler.js';
import * as routes from './src/routes/index.js';

// Constants
const PORT = process.env.PORT || 4000;
const CORS_OPTIONS = {
  origin: ['https://parcify.vercel.app', 'http://localhost:4321'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'client-id', 'X-Requested-With'],
  credentials: true
};

// App initialization
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware setup
const setupMiddleware = (app) => {
  app.use(bodyParser.json({ limit: '100mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
  app.use(cors(CORS_OPTIONS));
  app.use(morgan("dev"));
  app.use(express.json());
};


// Routes setup
const setupRoutes = (app) => {
  app.use('/auth', routes.authRoutes);
  app.use('/project', routes.projectRoutes);
  app.use('/template', routes.templateRoutes);
  app.use('/user', routes.userRoutes);
  app.use('/chat', routes.chatRoutes);
  app.use('/preferences', routes.preferencesRoutes);
  app.use('/generative', routes.generativeRoutes);

  // Test route
  app.get("/", (req, res) => {
    res.send({
      message: "Clients online in konva parcify",
      clients: websocket.getClients()
    });
  });
};

// Main setup function
const setupServer = () => {
  app.set("port", PORT);
  
  setupMiddleware(app);
  websocket.initWebsocket(wss);
  setupRoutes(app);
  
  app.use(errorHandler);

  server.listen(app.get("port"));
  console.log(`Server running on port ${app.get("port")}`);
};

// Run the server
setupServer();