export const promptHidden = (label) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("A secure terminal prompt is unavailable. Set SOUNDDESIGNER_ZXP_PASSWORD in the environment instead.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;

    const restore = () => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
      try { process.stdin.setRawMode(false); } catch (_error) {}
      process.stdin.pause();
    };
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      restore();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(result);
    };
    const onError = (error) => finish("", error);
    const onData = (chunk) => {
      const text = String(chunk);
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === "\u0003") {
          finish("", new Error("Certificate setup was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
          process.stdout.write("*");
        }
      }
    };

    process.stdout.write(label);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    process.stdin.on("error", onError);
  });
};
