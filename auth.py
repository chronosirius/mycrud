import pymysql
import config

class AuthManager:
    def authenticate(self, username, password):
        """Authenticate user against MySQL database"""
        try:
            # Try to connect with provided credentials
            conn = pymysql.connect(
                host=config.DB_HOST,
                user=username,
                password=password,
                database=config.DB_NAME,
                port=config.DB_PORT
            )
            conn.close()
            return True
        except pymysql.Error:
            return False
    
    def check_autologin(self, ip_address):
        """Check if IP address has auto-login configured"""
        if ip_address in config.AUTOLOGIN_KEYS:
            return config.AUTOLOGIN_KEYS[ip_address]
        return None