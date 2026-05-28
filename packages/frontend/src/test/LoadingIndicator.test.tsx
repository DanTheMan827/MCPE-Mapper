import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingIndicator } from '../components/LoadingIndicator';

describe('LoadingIndicator', () => {
  it('renders the loading message', () => {
    render(<LoadingIndicator message="Loading world..." />);
    expect(screen.getByText('Loading world...')).toBeInTheDocument();
  });

  it('renders the spinner element', () => {
    const { container } = render(<LoadingIndicator message="Test" />);
    const spinner = container.querySelector('.spinner');
    expect(spinner).toBeInTheDocument();
  });

  it('has the loading-indicator class', () => {
    const { container } = render(<LoadingIndicator message="Test" />);
    expect(container.firstChild).toHaveClass('loading-indicator');
  });
});
