"""Movie Hunt stream — serve video files for Watch button."""
import os
from flask import send_file, request, jsonify

from .helpers import _get_movie_hunt_instance_id_from_request, movie_hunt_logger
from .discovery_movie import _get_collection_config

logger = movie_hunt_logger


def _get_file_path_for_movie(tmdb_id, instance_id):
    """Resolve file path for a movie in the collection. Returns (path, error_msg)."""
    if not tmdb_id or not instance_id:
        return None, "Missing tmdb_id or instance_id"

    items = _get_collection_config(instance_id)
    movie = None
    for item in items:
        if item.get("tmdb_id") == tmdb_id:
            movie = item
            break
    if not movie:
        return None, "Movie not in collection"

    file_path = (movie.get("file_path") or "").strip()
    if file_path and os.path.isfile(file_path):
        return file_path, None

    root_folder = (movie.get("root_folder") or "").strip()
    if not root_folder:
        return None, "No file path or root folder"

    title = (movie.get("title") or "").strip()
    year = str(movie.get("year") or "").strip()
    if not title:
        return None, "No title"

    folder_name = "%s (%s)" % (title, year) if year else title
    movie_folder = os.path.join(root_folder, folder_name)
    if not os.path.isdir(movie_folder):
        return None, "Movie folder not found"

    video_exts = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".flv"}
    best_path, best_size = None, 0
    for name in os.listdir(movie_folder):
        ext = os.path.splitext(name)[1].lower()
        if ext in video_exts:
            fpath = os.path.join(movie_folder, name)
            try:
                size = os.path.getsize(fpath)
                if size > best_size:
                    best_size = size
                    best_path = fpath
            except OSError:
                pass
    if best_path:
        return best_path, None
    return None, "No video file found"


def register_movie_stream_routes(bp):
    @bp.route("/api/movie-hunt/stream/<int:tmdb_id>", methods=["GET"])
    def api_movie_hunt_stream(tmdb_id):
        """Stream a movie file. Requires instance_id. Supports Range for seeking."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({"error": "instance_id required"}), 400

        file_path, err = _get_file_path_for_movie(tmdb_id, instance_id)
        if err:
            return jsonify({"error": err}), 404

        if not os.path.isfile(file_path):
            return jsonify({"error": "File not found"}), 404

        ext = os.path.splitext(file_path)[1].lower()
        mimetypes = {
            ".mp4": "video/mp4",
            ".mkv": "video/x-matroska",
            ".avi": "video/x-msvideo",
            ".mov": "video/quicktime",
            ".wmv": "video/x-ms-wmv",
            ".m4v": "video/x-m4v",
            ".webm": "video/webm",
        }
        mimetype = mimetypes.get(ext) or "video/mp4"

        try:
            return send_file(
                file_path,
                mimetype=mimetype,
                as_attachment=False,
                conditional=True,
                etag=False,
            )
        except Exception as e:
            logger.exception("Stream error for tmdb_id=%s: %s", tmdb_id, e)
            return jsonify({"error": "Stream failed"}), 500
