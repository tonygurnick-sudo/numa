/**
 * Character count indicator for form fields.
 * Turns orange when within 10% of the limit.
 * Uses .profile-char-count styles from _user_profile.scss.
 */
export function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const isNear = len > max * 0.9;
  return (
    <div className={`profile-char-count ${isNear ? 'is-near' : ''}`}>
      {len}/{max}
    </div>
  );
}
