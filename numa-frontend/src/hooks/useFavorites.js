import { useState } from 'react';

const STORAGE_KEY = 'numaAppFavorites';

export const useFavorites = () => {
  // Initialize from localStorage
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (appId) => {
    // Get current state from localStorage to ensure we're in sync
    const currentFavorites = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

    // Check if item exists in current favorites
    const exists = currentFavorites.includes(appId);

    // Update favorites list
    const newFavorites = exists
      ? currentFavorites.filter(id => id !== appId)
      : [...currentFavorites, appId];

    // Update both localStorage and state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
    setFavorites(newFavorites);
  };

  const isFavorite = (appId) => {
    // Read directly from localStorage for most up-to-date state
    const currentFavorites = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return currentFavorites.includes(appId);
  };

  return { favorites, toggleFavorite, isFavorite };
};
