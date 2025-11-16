# =============================================================
# 🐳 Quantina Core AI Relay Dockerfile
# Node 22 + ffmpeg + Railway-ready build
# =============================================================

FROM node:22-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Create app directory
WORKDIR /app

# Copy package files first (for efficient caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your code
COPY . .

# Expose your app port
EXPOSE 8080

# Start the app
CMD ["node", "index.mjs"]
