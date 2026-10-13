#!/usr/bin/env python3
"""Minimal HTTP entrypoint for the ``instaloader-master`` Vercel service.

Exposes Instaloader's public, read-only lookups over HTTP so other
services (e.g. ``app`` via its ``INSTALOADER_MASTER_URL`` binding) can
call it. Stdlib-only WSGI: Instaloader itself is imported lazily inside
the handlers, so ``/health`` answers even before its dependencies are
imported. No login/session is used; if Instagram demands one, the
endpoints answer with a JSON 502 instead of crashing.
"""

import json
import re
from urllib.parse import parse_qs, urlparse

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
SHORTCODE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_POSTS = 12


def _json(start_response, status, payload):
    body = json.dumps(payload).encode("utf-8")
    start_response(status, [("Content-Type", "application/json; charset=utf-8"),
                            ("Content-Length", str(len(body)))])
    return [body]


def _profile_payload(username):
    """Build the same profile JSON shape the app's /api/user returns."""
    import instaloader  # lazy: heavy + needs its own dependencies

    loader = instaloader.Instaloader()
    profile = instaloader.Profile.from_username(loader.context, username)

    posts = []
    try:
        for post in profile.get_posts():
            posts.append({
                "shortcode": post.shortcode,
                "url": "https://www.instagram.com/p/{}/".format(post.shortcode),
                "thumbnailUrl": getattr(post, "url", None),
                "isVideo": bool(getattr(post, "is_video", False)),
                "likes": getattr(post, "likes", None),
                "takenAt": int(post.date_utc.timestamp()) if getattr(post, "date_utc", None) else None,
            })
            if len(posts) >= MAX_POSTS:
                break
    except Exception:
        # A profile can resolve while its timeline stays behind a login wall.
        posts = []

    return {
        "status": "success",
        "blocked": False,
        "username": profile.username,
        "profileUrl": "https://www.instagram.com/{}/".format(profile.username),
        "fullName": getattr(profile, "full_name", None) or None,
        "biography": getattr(profile, "biography", None) or None,
        "avatarUrl": getattr(profile, "profile_pic_url", None),
        "isPrivate": getattr(profile, "is_private", None),
        "isVerified": getattr(profile, "is_verified", None),
        "counts": {
            "followers": getattr(profile, "followers", None),
            "following": getattr(profile, "followees", None),
            "posts": getattr(profile, "mediacount", None),
        },
        "posts": posts,
    }


def app(environ, start_response):
    """WSGI entrypoint (Vercel Python service: ``app.py``)."""
    path = urlparse(environ.get("PATH_INFO", "/")).path.rstrip("/") or "/"
    query = parse_qs(environ.get("QUERY_STRING", ""))

    if path in ("/", "/health"):
        version = None
        try:
            import instaloader
            version = getattr(instaloader, "__version__", None)
        except Exception:
            version = None
        return _json(start_response, "200 OK", {
            "status": "ok", "service": "instaloader-master", "instaloaderVersion": version,
        })

    if path == "/api/profile":
        username = (query.get("username") or [""])[0].lstrip("@").lower()
        if not USERNAME_RE.match(username):
            return _json(start_response, "400 Bad Request", {"error": "Parámetro 'username' inválido."})
        try:
            return _json(start_response, "200 OK", _profile_payload(username))
        except Exception as exc:  # ProfileNotExists, login wall, network, ...
            name = type(exc).__name__
            status = "404 Not Found" if name.endswith("NotExistsException") else "502 Bad Gateway"
            return _json(start_response, status, {
                "error": "Instaloader no pudo resolver @{} ({}). Sin sesión, Instagram "
                         "puede exigir login para este perfil.".format(username, name),
            })

    if path == "/api/post":
        shortcode = (query.get("shortcode") or [""])[0]
        if not SHORTCODE_RE.match(shortcode):
            return _json(start_response, "400 Bad Request", {"error": "Parámetro 'shortcode' inválido."})
        try:
            import instaloader
            loader = instaloader.Instaloader()
            post = instaloader.Post.from_shortcode(loader.context, shortcode)
            return _json(start_response, "200 OK", {
                "shortcode": post.shortcode,
                "url": "https://www.instagram.com/p/{}/".format(post.shortcode),
                "isVideo": bool(getattr(post, "is_video", False)),
                "mediaUrl": getattr(post, "video_url", None) or getattr(post, "url", None),
                "thumbnailUrl": getattr(post, "url", None),
                "likes": getattr(post, "likes", None),
                "ownerUsername": getattr(getattr(post, "owner_profile", None), "username", None),
            })
        except Exception as exc:
            return _json(start_response, "502 Bad Gateway", {
                "error": "Instaloader no pudo resolver la publicación ({}).".format(type(exc).__name__),
            })

    return _json(start_response, "404 Not Found", {"error": "Endpoint no encontrado."})


# Local smoke run: ``python app.py`` (Vercel uses the WSGI ``app`` above)
if __name__ == "__main__":
    from wsgiref.simple_server import make_server

    port = 8080
    print("instaloader-master service on http://localhost:{}".format(port))
    make_server("0.0.0.0", port, app).serve_forever()
