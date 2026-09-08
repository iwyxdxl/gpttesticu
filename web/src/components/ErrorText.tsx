export function ErrorText({ message }: { message: string }) {
  return <pre className="request-error-text">{message}</pre>;
}
