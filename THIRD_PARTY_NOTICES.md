# Third-party notices

## Hydra Launcher test fixtures

`tests/fixtures/hydra-4.3.0/` contains unmodified text source files from
[hydralauncher/hydra](https://github.com/hydralauncher/hydra), tag `v4.3.0`,
commit `5845549311a20d485d027da875307fc70897bfdc`, obtained through the GitHub plugin.
They are used to check the integration installer against actual upstream files.
The surrounding integration code is newly authored in this project.

MIT License

Copyright (c) 2024 Los Broxas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Ludusavi

The adapter invokes a separately installed or Hydra-bundled Ludusavi executable.
No Ludusavi executable or manifest database is bundled in this project.
CLI contracts were inspected in the upstream documentation:
[Ludusavi CLI](https://github.com/mtkennerly/ludusavi/blob/master/docs/cli.md)
and [general output schema](https://github.com/mtkennerly/ludusavi/blob/master/docs/schema/general-output.yaml).
The upstream executable and manifests retain their respective licenses and notices.
