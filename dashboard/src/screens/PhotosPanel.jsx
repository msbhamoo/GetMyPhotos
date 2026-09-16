import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { navigate } from '../router.js'

export function PhotosPanel({ id }) {
  const [photos, setPhotos] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [activePhoto, setActivePhoto] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const limit = 40

  const loadPhotos = (currentOffset = 0, currentFilter = 'all', append = false) => {
    setLoading(true)
    setError(null)
    const statusParam = currentFilter !== 'all' ? `&status=${currentFilter}` : ''
    api(`/events/${id}/photos?limit=${limit}&offset=${currentOffset}${statusParam}`)
      .then((data) => {
        setTotal(data.total)
        setPhotos(append ? [...photos, ...data.photos] : data.photos)
        setOffset(currentOffset)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadPhotos(0, filter, false)
  }, [id, filter])

  const handleFilterChange = (f) => {
    setFilter(f)
  }

  const handleLoadMore = () => {
    const nextOffset = offset + limit
    loadPhotos(nextOffset, filter, true)
  }

  const handleDelete = async (photoId, e) => {
    if (e) e.stopPropagation()
    if (!confirm('Are you sure you want to delete this photo from the event?')) return
    setDeletingId(photoId)
    try {
      await api(`/events/${id}/photos/${photoId}`, { method: 'DELETE' })
      setPhotos((prev) => prev.filter((p) => p.id !== photoId))
      setTotal((prev) => Math.max(0, prev - 1))
      if (activePhoto?.id === photoId) setActivePhoto(null)
    } catch (err) {
      alert('Failed to delete photo: ' + errorText(err))
    } finally {
      setDeletingId(null)
    }
  }

  const handleHide = async (photoId, e) => {
    if (e) e.stopPropagation()
    try {
      await api(`/events/${id}/photos/${photoId}/hide`, { method: 'POST' })
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, status: 'hidden' } : p))
      )
      if (activePhoto?.id === photoId) {
        setActivePhoto((prev) => ({ ...prev, status: 'hidden' }))
      }
    } catch (err) {
      alert('Failed to hide photo: ' + errorText(err))
    }
  }

  // Keyboard navigation for Lightbox
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!activePhoto) return
      if (e.key === 'Escape') setActivePhoto(null)
      const currentIndex = photos.findIndex((p) => p.id === activePhoto.id)
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) {
        setActivePhoto(photos[currentIndex + 1])
      }
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setActivePhoto(photos[currentIndex - 1])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePhoto, photos])

  const currentIndex = activePhoto ? photos.findIndex((p) => p.id === activePhoto.id) : -1

  return (
    <div class="panel stack">
      <div class="panel-header">
        <div>
          <h2>Event Photos ({total})</h2>
          <p class="muted small">All photos uploaded to this event with AI face detection details.</p>
        </div>
        <div class="filter-group">
          {['all', 'done', 'processing', 'hidden'].map((f) => (
            <button
              key={f}
              class={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => handleFilterChange(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && <p class="error">{errorText(error)}</p>}

      {photos.length === 0 && !loading && (
        <div class="gallery-empty">
          <div class="empty-icon">🖼️</div>
          <h3>No photos {filter !== 'all' ? `with status "${filter}"` : 'uploaded yet'}</h3>
          <p class="muted">Upload photos to start AI face scanning and guest delivery.</p>
          <button class="btn primary" onClick={() => navigate(`/events/${id}?tab=upload`, true)}>
            ⬆ Go to Upload Tab
          </button>
        </div>
      )}

      {photos.length > 0 && (
        <div class="gallery-grid">
          {photos.map((p) => (
            <div
              key={p.id}
              class="gallery-card"
              onClick={() => setActivePhoto(p)}
            >
              <img
                src={p.thumb_url}
                alt=""
                loading="lazy"
                class="gallery-thumb"
              />
              <div class="gallery-overlay">
                <span class="face-badge">
                  {p.face_count > 0 ? `👥 ${p.face_count} face${p.face_count > 1 ? 's' : ''}` : 'No face'}
                </span>
                <div class="card-actions">
                  <button
                    class="icon-btn delete-btn"
                    title="Delete photo"
                    disabled={deletingId === p.id}
                    onClick={(e) => handleDelete(p.id, e)}
                  >
                    🗑
                  </button>
                </div>
              </div>
              {p.status !== 'done' && (
                <span class={`status-badge ${p.status}`}>{p.status}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {loading && <p class="muted center">Loading photos…</p>}

      {!loading && photos.length < total && (
        <div class="center">
          <button class="btn secondary" onClick={handleLoadMore}>
            Load More ({total - photos.length} remaining)
          </button>
        </div>
      )}

      {/* Lightbox Modal */}
      {activePhoto && (
        <div class="lightbox" onClick={() => setActivePhoto(null)}>
          <div class="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button class="lightbox-close" onClick={() => setActivePhoto(null)}>
              ✕
            </button>

            {currentIndex > 0 && (
              <button
                class="lightbox-nav prev"
                onClick={() => setActivePhoto(photos[currentIndex - 1])}
                title="Previous photo (Left arrow)"
              >
                ‹
              </button>
            )}

            {currentIndex < photos.length - 1 && (
              <button
                class="lightbox-nav next"
                onClick={() => setActivePhoto(photos[currentIndex + 1])}
                title="Next photo (Right arrow)"
              >
                ›
              </button>
            )}

            <div class="lightbox-img-wrap">
              <img src={activePhoto.web_url || activePhoto.thumb_url} alt="" class="lightbox-img" />
            </div>

            <div class="lightbox-footer">
              <div class="photo-info">
                <span>
                  <b>Faces detected:</b> {activePhoto.face_count}
                </span>
                {activePhoto.width && activePhoto.height && (
                  <span>
                    <b>Size:</b> {activePhoto.width} × {activePhoto.height} px
                  </span>
                )}
                {activePhoto.status && (
                  <span>
                    <b>Status:</b> {activePhoto.status}
                  </span>
                )}
              </div>
              <div class="lightbox-actions">
                <a
                  href={activePhoto.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn small secondary"
                >
                  Open Full ↗
                </a>
                {activePhoto.status !== 'hidden' && (
                  <button class="btn small" onClick={() => handleHide(activePhoto.id)}>
                    Hide from Guests
                  </button>
                )}
                <button
                  class="btn small danger"
                  disabled={deletingId === activePhoto.id}
                  onClick={() => handleDelete(activePhoto.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
