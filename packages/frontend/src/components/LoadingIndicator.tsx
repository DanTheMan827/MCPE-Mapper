import React from 'react';

interface LoadingIndicatorProps {
  message: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ message }) => {
  return (
    <div className="loading-indicator">
      <div className="spinner" />
      {message}
    </div>
  );
};
