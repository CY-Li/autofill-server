# Use Node.js LTS version
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Create necessary directories and set permissions
RUN mkdir -p uploads public && \
    chown -R node:node /app && \
    chmod -R 755 /app

# Use non-root user
USER node

# Expose port
EXPOSE 8080

# Start the app
CMD ["npm", "start"] 