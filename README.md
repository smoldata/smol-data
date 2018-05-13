# Create config.js

Copy `config.js.example` to `config.js` and review for any changes you might want to make.

# Generate a self-signed SSL certificate

```
openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=Smol Data/CN=localhost"
```
