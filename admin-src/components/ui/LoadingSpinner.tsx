export default function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--color-background)',
    }}>
      <div style={{
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
      }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '4px solid var(--color-surface-elevated)',
            borderTopColor: 'var(--color-primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p>Loading...</p>
      </div>
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
