// List of abbreviations that should remain uppercase
const UPPERCASE_WORDS = ['HR', 'IT', 'API', 'UI', 'UX'];

export const formatCategory = (category) => {
  if (!category) return '';

  // Check if the category is in our uppercase list
  if (UPPERCASE_WORDS.includes(category.toUpperCase())) {
    return category.toUpperCase();
  }

  // Otherwise capitalize first letter of each word
  return category.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
};
