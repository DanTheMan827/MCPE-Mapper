import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileDropZone } from '../components/FileDropZone';

describe('FileDropZone', () => {
  it('renders the title', () => {
    render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    expect(screen.getByText('🗺️ MCPE Mapper')).toBeInTheDocument();
  });

  it('renders the drop instruction', () => {
    render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    expect(screen.getByText(/Drop a .mcworld file/)).toBeInTheDocument();
  });

  it('shows backend connection form when link is clicked', () => {
    render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    fireEvent.click(screen.getByText('connect to a backend server'));
    expect(screen.getByText('🔌 Connect to Backend')).toBeInTheDocument();
  });

  it('renders back button in backend mode', () => {
    render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    fireEvent.click(screen.getByText('connect to a backend server'));
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('goes back to file mode when back is clicked', () => {
    render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    fireEvent.click(screen.getByText('connect to a backend server'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('🗺️ MCPE Mapper')).toBeInTheDocument();
  });

  it('has the file-drop-zone class', () => {
    const { container } = render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    expect(container.firstChild).toHaveClass('file-drop-zone');
  });

  it('adds dragging class on dragover', () => {
    const { container } = render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    const dropZone = container.firstChild as HTMLElement;
    fireEvent.dragOver(dropZone);
    expect(dropZone).toHaveClass('dragging');
  });

  it('removes dragging class on dragleave', () => {
    const { container } = render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    const dropZone = container.firstChild as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    expect(dropZone).not.toHaveClass('dragging');
  });

  it('has a hidden file input', () => {
    const { container } = render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).toHaveStyle({ display: 'none' });
  });

  it('accepts .mcworld and .zip files', () => {
    const { container } = render(<FileDropZone onFileLoad={() => {}} onBackendConnect={() => {}} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', '.mcworld,.zip');
  });
});
