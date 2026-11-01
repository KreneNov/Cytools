import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import styles from './AnimatedThemeToggle.module.css';

interface AnimatedThemeToggleProps {
  className?: string;
  id?: string;
}

export const AnimatedThemeToggle: React.FC<AnimatedThemeToggleProps> = ({
  className = '',
  id = 'animated-theme-toggle',
}) => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleToggle = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <label
      htmlFor={id}
      className={`${styles.theme} ${className}`}
      title={isDark ? 'Đang ở Giao diện Tối - Nhấn để chuyển sang Sáng' : 'Đang ở Giao diện Sáng - Nhấn để chuyển sang Tối'}
    >
      <span className={styles.themeToggleWrap}>
        <input
          id={id}
          className={styles.themeToggle}
          type="checkbox"
          role="switch"
          name="theme"
          value="dark"
          checked={isDark}
          onChange={handleToggle}
          aria-label="Chuyển đổi giao diện Sáng / Tối"
        />
        <span className={styles.themeIcon} aria-hidden="true">
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
          <span className={styles.themeIconPart}></span>
        </span>
      </span>
    </label>
  );
};

export default AnimatedThemeToggle;
