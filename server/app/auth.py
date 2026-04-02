import os
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SECRET_KEY = os.environ.get("API_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("API_SECRET_KEY must be set")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Admin password hash — MUST be set via env variable
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH")

# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Decode and verify a JWT token. Raises JWTError on failure."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


def get_current_admin(request: Request):
    """Dependency that checks for a valid JWT in the 'access_token' cookie.

    Raises HTTP 303 redirect to login page if not authenticated.
    """
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/admin/login"},
        )
    try:
        payload = verify_token(token)
        if payload.get("sub") != "admin":
            raise JWTError("invalid subject")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/admin/login"},
        )
    return payload
