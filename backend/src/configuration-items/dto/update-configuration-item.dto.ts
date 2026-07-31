import { PartialType } from '@nestjs/swagger';
import { CreateConfigurationItemDto } from './create-configuration-item.dto';

export class UpdateConfigurationItemDto extends PartialType(
  CreateConfigurationItemDto,
) {}
