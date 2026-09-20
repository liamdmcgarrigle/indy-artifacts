import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <link rel="stylesheet" href="/themes/default.css" />
      <main className="index">
        <h1>Not here</h1>
        <p className="index__lede">That artifact, version or block does not exist.</p>
        <Link className="btn" href="/">
          Back to the index
        </Link>
      </main>
    </>
  );
}
