# Use Node.js LTS version
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p uploads && \
    chown -R node:node uploads && \
    chmod 755 uploads

# Use non-root user
USER node

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"] 