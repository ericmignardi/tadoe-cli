import chalk from 'chalk';

const LOGO = `
  ████████╗ █████╗ ██████╗  ██████╗ ███████╗
  ╚══██╔══╝██╔══██╗██╔══██╗██╔═══██╗██╔════╝
     ██║   ███████║██║  ██║██║   ██║█████╗  
     ██║   ██╔══██║██║  ██║██║   ██║██╔══╝  
     ██║   ██║  ██║██████╔╝╚██████╔╝███████╗
     ╚═╝   ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚══════╝
`;

export function printAsciiLogo() {
  const lines = LOGO.split('\n');
  const colors = [
    chalk.hex('#8A2BE2'), // BlueViolet
    chalk.hex('#9370DB'), // MediumPurple
    chalk.hex('#BA55D3'), // MediumOrchid
    chalk.hex('#DA70D6'), // Orchid
    chalk.hex('#EE82EE'), // Violet
    chalk.hex('#FF00FF'), // Magenta
    chalk.hex('#FF1493'), // DeepPink
  ];

  console.log('\n');
  lines.forEach((line, index) => {
    const color = colors[index % colors.length] || chalk.magenta;
    console.log(color(line));
  });
  console.log(chalk.gray(`  Tadoe CLI — Local AI Terminal Agent v1.0.0`));
  console.log(chalk.gray(`  ---------------------------------------------\n`));
}
