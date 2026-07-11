from connectors._social_media import partition_post_media
from connectors._video_cover import (
    fit_cover_jpeg,
    instagram_cover_url,
    prepare_facebook_video_bytes,
)
from lib.planner.attached_media import cover_attachment


def test_partition_video_and_thumbnail_roles():
    version = {
        'content': [
            {
                'type': 'media',
                'media': [
                    {'mime_type': 'video/mp4', 'url': 'https://example.com/v.mp4'},
                    {'mime_type': 'image/jpeg', 'url': 'https://example.com/c.jpg', 'role': 'thumbnail'},
                ],
            },
        ],
    }
    parts = partition_post_media(version)
    assert len(parts['videos']) == 1
    assert len(parts['thumbnails']) == 1
    assert parts['thumbnails'][0]['url'].endswith('c.jpg')


def test_instagram_cover_url_rejects_non_http():
    assert instagram_cover_url({'url': '/uploads/x.jpg'}) is None
    assert instagram_cover_url({'url': 'https://cdn.example.com/cover.jpg'}) == 'https://cdn.example.com/cover.jpg'


def test_cover_attachment_video_plus_image():
    attached = [
        {'id': 'v1', 'mime_type': 'video/mp4', 'url': 'https://example.com/v.mp4'},
        {'id': 'i1', 'mime_type': 'image/jpeg', 'url': 'https://example.com/c.jpg'},
    ]
    cover = cover_attachment(attached)
    assert cover is not None
    assert cover['id'] == 'i1'


def test_prepare_facebook_video_bytes_no_cover():
    out, thumb, cover_bytes, injected = prepare_facebook_video_bytes(
        {'url': 'https://example.com/v.mp4'},
        None,
    )
    assert out is None
    assert thumb is None
    assert cover_bytes is None
    assert injected is False


def test_prepare_facebook_video_bytes_injects(monkeypatch):
    import connectors._video_cover as vc

    monkeypatch.setattr(
        vc,
        'download_media_from_url',
        lambda url, **_: (b'vid' if 'v.mp4' in url else b'img', 'application/octet-stream'),
    )
    monkeypatch.setattr(vc, 'inject_cover_image', lambda _v, _c, **_: (b'merged', True))
    monkeypatch.setattr(vc, 'extract_video_frame_jpeg', lambda _b, _t: b'frame0')
    out, thumb, cover_bytes, injected = prepare_facebook_video_bytes(
        {'url': 'https://example.com/v.mp4'},
        {'url': 'https://example.com/c.jpg'},
    )
    assert out == b'merged'
    assert thumb == b'frame0'
    assert cover_bytes == b'img'
    assert injected is True


def test_fit_cover_jpeg_preserves_portrait_width():
    from PIL import Image
    import io

    buf = io.BytesIO()
    Image.new('RGB', (200, 400), (255, 0, 0)).save(buf, 'PNG')
    jpeg = fit_cover_jpeg(buf.getvalue(), 386, 218)
    assert jpeg is not None
    with Image.open(io.BytesIO(jpeg)) as img:
        assert img.size == (386, 218)
        # Full video width used — not a narrow center strip.
        pixels = img.load()
        assert pixels[0, img.size[1] // 2] != (0, 0, 0) or pixels[385, img.size[1] // 2] != (0, 0, 0)


def test_facebook_apply_injected_cover_thumbnail(monkeypatch):
    import connectors._video_cover as vc

    monkeypatch.setattr(vc, 'wait_facebook_video_ready', lambda **_: None)
    monkeypatch.setattr(vc, '_facebook_thumb_dimensions', lambda **_: (386, 218))
    monkeypatch.setattr(vc, 'fit_cover_jpeg', lambda _b, _w, _h: b'jpeg')
    monkeypatch.setattr(vc, 'extract_video_frame_jpeg', lambda _b, _t: b'frame0')

    calls = {'n': 0}

    def post_thumb(**kwargs):
        calls['n'] += 1
        return calls['n'] == 1

    monkeypatch.setattr(vc, '_facebook_post_preferred_thumbnail', post_thumb)
    monkeypatch.setattr(vc, '_facebook_thumbnails_list', lambda **_: [])

    ok = vc.facebook_apply_injected_cover_thumbnail(
        video_id='vid123',
        cover_bytes=b'cover',
        thumb_jpeg=b'jpeg',
        upload_bytes=b'mp4',
        access_token='tok',
        graph_root='https://graph.facebook.com/v25.0',
    )
    assert ok is True
