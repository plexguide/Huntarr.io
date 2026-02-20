"""
Chat Mixin — lightweight in-app messaging between owner and users.
"""

import sqlite3
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class ChatMixin:
    """DB methods for the chat_messages table."""

    def get_chat_messages(self, limit: int = 100, before_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get recent chat messages, newest last."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                if before_id:
                    rows = conn.execute(
                        "SELECT * FROM chat_messages WHERE id < ? ORDER BY id DESC LIMIT ?",
                        (before_id, limit)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?",
                        (limit,)
                    ).fetchall()
                return list(reversed([dict(r) for r in rows]))
        except Exception as e:
            logger.error(f"Error getting chat messages: {e}")
            return []

    def create_chat_message(self, user_id: int, username: str, role: str, message: str) -> Optional[int]:
        """Insert a chat message. Returns the new row id."""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute(
                    "INSERT INTO chat_messages (user_id, username, role, message) VALUES (?, ?, ?, ?)",
                    (user_id, username, role, message)
                )
                conn.commit()
                return cursor.lastrowid
        except Exception as e:
            logger.error(f"Error creating chat message: {e}")
            return None

    def delete_chat_message(self, message_id: int) -> bool:
        """Delete a single chat message (owner moderation)."""
        try:
            with self.get_connection() as conn:
                conn.execute("DELETE FROM chat_messages WHERE id = ?", (message_id,))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error deleting chat message: {e}")
            return False

    def clear_chat_messages(self) -> bool:
        """Delete all chat messages (owner moderation)."""
        try:
            with self.get_connection() as conn:
                conn.execute("DELETE FROM chat_messages")
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error clearing chat: {e}")
            return False

    def get_chat_message_by_id(self, message_id: int) -> Optional[Dict[str, Any]]:
        """Get a single chat message by id."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT * FROM chat_messages WHERE id = ?", (message_id,)).fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"Error getting chat message: {e}")
            return None
