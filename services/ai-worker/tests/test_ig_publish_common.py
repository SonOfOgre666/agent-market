from pathlib import Path

import connectors._ig_publish_common as ig


def test_host_unreliable_for_meta_fetch():
    assert ig.host_unreliable_for_meta_fetch('https://chelsie.ngrok-free.dev/uploads/a.mp4')
    assert ig.host_unreliable_for_meta_fetch('http://127.0.0.1:4010/uploads/a.mp4')
    assert not ig.host_unreliable_for_meta_fetch('https://cdn.example.com/uploads/a.mp4')


def test_rewrite_upload_url_for_worker(monkeypatch):
    monkeypatch.setenv('INTERNAL_API_URL', 'http://127.0.0.1:4010')
    assert (
        ig.rewrite_upload_url_for_worker('https://public.example/uploads/vid.mp4')
        == 'http://127.0.0.1:4010/uploads/vid.mp4'
    )
    assert ig.rewrite_upload_url_for_worker('https://cdn.example.com/other.mp4') == 'https://cdn.example.com/other.mp4'


def test_resolve_local_upload_path(tmp_path, monkeypatch):
    monkeypatch.setenv('STORAGE_LOCAL_PATH', str(tmp_path))
    f = tmp_path / 'clip.mp4'
    f.write_bytes(b'abc')
    assert ig.resolve_local_upload_path('https://x.ngrok-free.dev/uploads/clip.mp4') == f
    assert ig.resolve_local_upload_path('https://x.ngrok-free.dev/uploads/missing.mp4') is None


def test_wait_media_container_includes_status(monkeypatch):
    calls = {'n': 0}

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            calls['n'] += 1
            return {'status_code': 'ERROR', 'status': '2207052; Media download failed'}

    monkeypatch.setattr(ig.httpx, 'get', lambda *a, **k: Resp())
    try:
        ig.wait_media_container(session='https://graph.instagram.com/v21.0', container_id='1', token='t', poll_s=0)
        assert False, 'expected error'
    except RuntimeError as exc:
        assert '2207052' in str(exc)


def test_create_ig_video_container_prefers_resumable(monkeypatch):
    posts = []

    class Resp:
        def __init__(self, status_code=200, body=None, text=''):
            self.status_code = status_code
            self._body = body or {}
            self.content = b'{}'
            self.text = text

        def raise_for_status(self):
            if self.status_code >= 400:
                raise ig.httpx.HTTPStatusError('err', request=None, response=self)

        def json(self):
            return self._body

    def fake_post(url, **kwargs):
        posts.append((url, kwargs))
        if 'rupload.facebook.com' in url:
            return Resp(body={'success': True})
        if url.endswith('/media'):
            return Resp(body={'id': 'cid1', 'uri': 'https://rupload.facebook.com/ig-api-upload/v21.0/cid1'})
        return Resp()

    monkeypatch.setattr(ig, 'load_media_bytes', lambda _item: b'video-bytes')
    monkeypatch.setattr(ig, 'wait_media_container', lambda **_: None)
    monkeypatch.setattr(ig.httpx, 'post', fake_post)

    cid = ig.create_ig_video_container(
        root='https://graph.instagram.com/v21.0',
        ig_id='ig1',
        token='tok',
        video_item={'url': 'https://x.ngrok-free.dev/uploads/v.mp4'},
        media_type='REELS',
        caption='hi',
        cover_url='https://x.ngrok-free.dev/uploads/c.jpg',
    )
    assert cid == 'cid1'
    create_data = posts[0][1]['data']
    assert create_data['upload_type'] == 'resumable'
    assert create_data['thumb_offset'] == '0'
    assert 'cover_url' not in create_data
    assert 'rupload.facebook.com' in posts[1][0]
    assert posts[1][1]['content'] == b'video-bytes'


def test_create_ig_video_container_falls_back_to_url(monkeypatch):
    posts = []

    class Resp:
        status_code = 200
        content = b'{}'

        def raise_for_status(self):
            return None

        def json(self):
            return {'id': 'cid-url'}

    def fake_post(url, **kwargs):
        posts.append((url, kwargs))
        if kwargs.get('data', {}).get('upload_type') == 'resumable':
            raise RuntimeError('resumable unavailable')
        return Resp()

    monkeypatch.setattr(ig, 'load_media_bytes', lambda _item: b'bytes')
    monkeypatch.setattr(ig, '_resumable_upload_video', lambda **_: (_ for _ in ()).throw(RuntimeError('nope')))
    monkeypatch.setattr(ig, 'wait_media_container', lambda **_: None)
    monkeypatch.setattr(ig.httpx, 'post', fake_post)

    cid = ig.create_ig_video_container(
        root='https://graph.instagram.com/v21.0',
        ig_id='ig1',
        token='tok',
        video_item={'url': 'https://cdn.example.com/v.mp4'},
        media_type='REELS',
        cover_url='https://cdn.example.com/c.jpg',
    )
    assert cid == 'cid-url'
    data = posts[0][1]['data']
    assert data['video_url'] == 'https://cdn.example.com/v.mp4'
    assert data['cover_url'] == 'https://cdn.example.com/c.jpg'
