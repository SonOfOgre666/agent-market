import axios from 'axios'
import { getDecryptedConfig } from '../models/Integration.js'

export async function fetchFromUnsplash(query, page = 1) {
  const config = await getDecryptedConfig('unsplash')
  if (!config.access_key) throw new Error('Unsplash API key not configured')

  const endpoint = query
    ? `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=20`
    : `https://api.unsplash.com/photos?page=${page}&per_page=20&order_by=popular`

  const res = await axios.get(endpoint, { headers: { Authorization: `Client-ID ${config.access_key}` } })
  const photos = query ? res.data.results : res.data

  return photos.map(photo => ({
    id: photo.id,
    url: photo.urls.regular,
    thumb: photo.urls.thumb,
    download_location: photo.links.download_location,
    width: photo.width,
    height: photo.height,
    description: photo.description || photo.alt_description,
    credit: { name: photo.user.name, link: photo.user.links.html },
  }))
}

export async function fetchFromGiphy(query, page = 1) {
  const config = await getDecryptedConfig('giphy')
  if (!config.api_key) throw new Error('Giphy API key not configured')

  const offset = (page - 1) * 20
  const endpoint = query
    ? `https://api.giphy.com/v1/gifs/search?api_key=${config.api_key}&q=${encodeURIComponent(query)}&limit=20&offset=${offset}&rating=g`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${config.api_key}&limit=20&offset=${offset}&rating=g`

  const res = await axios.get(endpoint)
  return res.data.data.map(gif => ({
    id: gif.id,
    url: gif.images?.original?.url,
    preview: gif.images?.fixed_height_still?.url || gif.images?.preview_gif?.url,
    thumb: gif.images?.fixed_height?.url,
    width: gif.images?.original?.width,
    height: gif.images?.original?.height,
    title: gif.title,
    mime_type: 'image/gif',
  }))
}
